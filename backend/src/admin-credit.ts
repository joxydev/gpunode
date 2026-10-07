import {BadRequestException, ConflictException, NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import type {AdminBalanceCredit, PrismaClient} from '@prisma/client';
import {microsToDecimal} from './security.js';
import {notify} from './production.js';

export const MAX_LEDGER_MICROS = 9223372036854775807n;
export function parseCredit(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Некорректные данные пополнения.');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => !['amount', 'reason', 'idempotencyKey'].includes(key))) throw new BadRequestException('Некорректные данные пополнения.');
  if (typeof body.amount !== 'string' || !/^(0|[1-9]\d{0,12})([.,]\d{1,6})?$/.test(body.amount.trim())) throw new BadRequestException('Укажите положительную сумму USDT: до 6 знаков после запятой.');
  const [whole, fraction = ''] = body.amount.trim().replace(',', '.').split('.');
  const amountMicros = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (amountMicros <= 0n || amountMicros > MAX_LEDGER_MICROS) throw new BadRequestException('Сумма превышает допустимый диапазон.');
  if (typeof body.reason !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body.reason)) throw new BadRequestException('Укажите причину пополнения: от 3 до 500 символов.');
  const reason = body.reason.trim().replace(/\s+/g, ' ');
  if (reason.length < 3 || reason.length > 500) throw new BadRequestException('Укажите причину пополнения: от 3 до 500 символов.');
  if (typeof body.idempotencyKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.idempotencyKey)) throw new BadRequestException('Некорректный ключ операции.');
  return {amountMicros, reason, idempotencyKey: body.idempotencyKey.toLowerCase()};
}
export function presentCredit(row: AdminBalanceCredit) {
  return {id: row.id, actorId: row.actorId, userId: row.userId, amount: microsToDecimal(row.amountMicros), reason: row.reason,
    idempotencyKey: row.idempotencyKey, ledgerId: row.ledgerId, balanceBefore: microsToDecimal(row.balanceBeforeMicros), balanceAfter: microsToDecimal(row.balanceAfterMicros), createdAt: row.createdAt};
}
function sameCredit(row: AdminBalanceCredit, userId: string, data: ReturnType<typeof parseCredit>) {
  if (row.userId !== userId || row.amountMicros !== data.amountMicros || row.reason !== data.reason) throw new ConflictException('Ключ операции уже использован для другого пополнения.');
  return presentCredit(row);
}
/** The controller must authenticate the owner before entering this service. No TON records are created. */
export async function creditBalance(db: PrismaClient, actorId: string, userId: string, input: unknown) {
  const data = parseCredit(input);
  return db.$transaction(async tx => {
    // Scope the lock to owner + key BEFORE the recipient lock. A conflicting recipient
    // cannot use the same key in a second concurrent transaction.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actorId + ':' + data.idempotencyKey}, 781442))`;
    const prior = await tx.adminBalanceCredit.findUnique({where: {actorId_idempotencyKey: {actorId, idempotencyKey: data.idempotencyKey}}});
    if (prior) return sameCredit(prior, userId, data);
    const user = await tx.$queryRaw<{id: string}[]>`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    if (!user.length) throw new NotFoundException('Пользователь не найден.');
    const [total] = await tx.$queryRaw<{total: string}[]>`SELECT COALESCE(SUM("amountMicros"),0)::text AS total FROM "LedgerEntry" WHERE "userId"=${userId}`;
    const before = BigInt(total.total), after = before + data.amountMicros;
    if (before < -MAX_LEDGER_MICROS - 1n || after > MAX_LEDGER_MICROS) throw new BadRequestException('Баланс превышает допустимый диапазон.');
    const id = randomUUID();
    const ledger = await tx.ledgerEntry.create({data: {userId, kind: 'ADMIN_CREDIT', amountMicros: data.amountMicros, sourceId: 'admin-credit:' + id}});
    const row = await tx.adminBalanceCredit.create({data: {id, actorId, userId, ...data, ledgerId: ledger.id, balanceBeforeMicros: before, balanceAfterMicros: after}});
    await tx.audit.create({data: {actorId, action: 'ADMIN_BALANCE_CREDIT', targetId: id}});
    await notify(tx, {userId, type: 'ADMIN_CREDIT', title: 'Пополнение администратором', message: 'На доступный баланс зачислено ' + microsToDecimal(data.amountMicros) + ' USDT.', referenceType: 'ADMIN_CREDIT', referenceId: id, dedupeKey: 'admin-credit:' + id});
    return presentCredit(row);
  }, {maxWait: 10000, timeout: 15000});
}

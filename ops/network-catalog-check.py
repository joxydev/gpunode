#!/usr/bin/env python3
"""Validate a read-only psql catalogue snapshot, without repairing financial data."""
import argparse
from decimal import Decimal, InvalidOperation
from pathlib import Path


EXPECTED = {
    'NODE_4090': ('Node Alpha', '50.00', 30, '1.50', '1.80', 'REF-ALPHA-2026-01', 2500),
    'NODE_A100': ('Cluster Beta', '300.00', 60, '2.50', '3.00', 'REF-BETA-2026-02', 1000),
    'NODE_H100': ('Enterprise POD', '1200.00', 90, '3.50', '4.20', 'REF-ENT-2026-03', 250),
}
FIELDS = ('id', 'price_usdt', 'contract_days', 'daily_yield_percent',
          'compound_boost_percent', 'contract_reference', 'is_active',
          'is_experimental', 'supply_known', 'total_supply', 'available_supply',
          'max_per_user', 'reserved')


def validate(path, allow_legacy_limits=False):
    rows = [line.split('|') for line in Path(path).read_text().splitlines()]
    if len(rows) != 3 or {row[0] for row in rows} != set(EXPECTED):
        raise ValueError('Не найдены три действующие категории.')
    errors, messages = [], []
    for row in rows:
        label, price, days, base, compound, reference, cap = EXPECTED[row[0]]
        if len(row) != len(FIELDS):
            errors.append(f'{label}: число полей {len(row)}, ожидается {len(FIELDS)}.')
            continue
        data = dict(zip(FIELDS, row))
        for field, expected in (('price_usdt', price), ('daily_yield_percent', base),
                                ('compound_boost_percent', compound)):
            try:
                value = Decimal(data[field])
                matches = value.is_finite() and value == Decimal(expected)
            except InvalidOperation:
                matches = False
            if not matches:
                errors.append(f'{label}: {field}={data[field]!r}, ожидается {expected}.')
        integers = {}
        for field in ('contract_days', 'total_supply', 'available_supply', 'max_per_user', 'reserved'):
            try:
                integers[field] = int(data[field])
            except ValueError:
                errors.append(f'{label}: {field}={data[field]!r}, ожидается целое число.')
        if integers.get('contract_days') != days:
            errors.append(f'{label}: contract_days={data["contract_days"]!r}, ожидается {days}.')
        for field, expected in (('is_active', 't'), ('is_experimental', 'f'),
                                ('contract_reference', reference)):
            if data[field] != expected:
                errors.append(f'{label}: {field}={data[field]!r}, ожидается {expected!r}.')
        limit = integers.get('max_per_user')
        if limit != 1:
            if allow_legacy_limits and limit is not None and limit > 0:
                messages.append(f'{label}: прежний max_per_user={limit}; миграция 202610100004 установит 1.')
            else:
                errors.append(f'{label}: max_per_user={data["max_per_user"]!r}, ожидается 1.')
        known = data['supply_known']
        if known not in ('t', 'f'):
            errors.append(f'{label}: supply_known={known!r}, ожидается t/f.')
        if all(field in integers for field in ('total_supply', 'available_supply', 'reserved')):
            total, free, reserved = (integers[field] for field in ('total_supply', 'available_supply', 'reserved'))
            if not (0 <= total <= cap and 0 <= free <= total and reserved >= 0):
                errors.append(f'{label}: некорректный остаток total={total}, free={free}, reserved={reserved}, cap={cap}.')
            elif known == 't' and free > total - reserved:
                errors.append(f'{label}: free={free} превышает total={total} минус reserved={reserved}.')
            elif known == 'f' and (total != 0 or free != 0):
                errors.append(f'{label}: неподтверждённый каталог содержит total={total}, free={free}.')
            messages.append(f'{label}: сохранено total={total}, free={free}, reserved={reserved}, confirmed={known}')
    if errors:
        raise ValueError('\n'.join(errors))
    return messages


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot')
    parser.add_argument('--allow-legacy-limits', action='store_true',
                        help='Before migration only: allow a positive previous max_per_user.')
    args = parser.parse_args()
    try:
        for message in validate(args.snapshot, args.allow_legacy_limits):
            print(message)
    except (OSError, ValueError) as error:
        parser.exit(1, f'Каталог не прошёл проверку:\n{error}\n')


if __name__ == '__main__':
    main()

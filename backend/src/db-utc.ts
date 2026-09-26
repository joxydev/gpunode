import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';

// Prisma 7's pg adapter serializes Date parameters without a timezone suffix.
// Force UTC on every application connection even when the server or DB role
// defaults to a local timezone (the VPS uses Europe/Chisinau).
export function createDb(connectionString:string,max:number){
 return new PrismaClient({adapter:new PrismaPg({connectionString,max,options:'-c TimeZone=UTC'})});
}

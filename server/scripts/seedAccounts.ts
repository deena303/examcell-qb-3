/**
 * Seed Script: Creates initial user accounts with bcrypt-hashed passwords.
 * Run with: npx tsx server/scripts/seedAccounts.ts
 *
 * This script UPSERTS — safe to run multiple times.
 * Passwords are hashed with bcrypt (10 rounds) — never stored as plaintext.
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { upsertUserAccount } from '../services/authService';

const accounts = [
  {
    email: 'examcell@msajce-edu.in',
    password: 'Msajce@1234',
    role: 'EXAM_CELL' as const,
    name: 'Msajce'
  },
  {
    email: 'examcell@examcell-edu.in',
    password: 'Msajce@1234',
    role: 'EXAM_CELL' as const,
    name: 'Msajce'
  },
  {
    email: 'superadmin@examcell-edu.in',
    password: 'Admin@123',
    role: 'SUPER_ADMIN' as const,
    name: 'Dr. K. Mohamed Farooq'
  },
  {
    email: 'superaadmin@examcell-edu.in',
    password: 'Admin@123',
    role: 'SUPER_ADMIN' as const,
    name: 'Dr. K. Mohamed Farooq'
  },
  {
    email: 'superadmin@msajce-edu.in',
    password: 'Admin@123',
    role: 'SUPER_ADMIN' as const,
    name: 'Dr. K. Mohamed Farooq'
  },
  {
    email: 'superaadmin@msajce-edu.in',
    password: 'Admin@123',
    role: 'SUPER_ADMIN' as const,
    name: 'Dr. K. Mohamed Farooq'
  },
  // Principal account
  {
    email: 'principal@msajce-edu.in',
    password: 'Principal@1234',
    role: 'PRINCIPAL' as const,
    name: 'Dr. A. Principal'
  }
];

async function main() {
  console.log('\n🔐 MSAJCE — Seeding User Accounts');
  console.log('─'.repeat(40));

  for (const account of accounts) {
    try {
      await upsertUserAccount(account);
      console.log(`✅ Upserted: ${account.email} (${account.role})`);
    } catch (err: any) {
      console.error(`❌ Failed for ${account.email}:`, err?.message);
    }
  }

  console.log('\n✅ Seed complete.');
  console.log('   Passwords are hashed with bcrypt — NOT stored in plaintext.\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Seed script error:', err);
  process.exit(1);
});

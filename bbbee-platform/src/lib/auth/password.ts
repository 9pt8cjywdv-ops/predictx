import bcrypt from "bcryptjs";

const COST = 12;

export function validatePasswordPolicy(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 12) errors.push("Password must be at least 12 characters.");
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) errors.push("Password must mix upper- and lower-case letters.");
  if (!/[0-9]/.test(password)) errors.push("Password must contain a digit.");
  return errors;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Used to equalise timing when the account does not exist. */
export const DUMMY_HASH = "$2b$12$yLrPJGkhg5gV2ptoXK4TyewwQT0X9BSAb1BT48oRSeJhjS/u64Uhe";

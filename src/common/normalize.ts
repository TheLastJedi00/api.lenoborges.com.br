export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function normalizeBio(bio: string): string {
  return bio.trim();
}

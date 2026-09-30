export const USERNAME_REGEX = /^[a-zA-Z0-9]{3,20}$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidUsernameFormat = (username: string): boolean => {
  if (!username) return false;
  return USERNAME_REGEX.test(username.trim());
};

export const isValidEmailFormat = (email: string): boolean => {
  if (!email) return false;
  return EMAIL_REGEX.test(email.trim());
};

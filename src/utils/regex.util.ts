export const USERNAME_REGEX = /^(?=(?:[a-zA-Z0-9]*[a-zA-Z]){3})[a-zA-Z][a-zA-Z0-9]{2,19}$/;
export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export const isValidUsernameFormat = (username: string): boolean => {
  if (!username) return false;
  return USERNAME_REGEX.test(username);
};

export const isValidEmailFormat = (email: string): boolean => {
  if (!email) return false;
  return EMAIL_REGEX.test(email);
};

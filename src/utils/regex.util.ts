export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

export const isValidUsernameFormat = (username: string): boolean => {
  return USERNAME_REGEX.test(username);
};

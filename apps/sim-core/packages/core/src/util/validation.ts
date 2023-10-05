const invalidCharactersRegExp = /[^\w|\d|\-|_]/;

export const validateFileName: (name: string) => string | undefined = (
  name
) => {
  if (invalidCharactersRegExp.test(name)) {
    return "ONLY LETTERS, NUMBERS, - & _ ARE ALLOWED (NO SPACES)";
  }

  if (name === "") {
    return "NAME CANNOT BE BLANK";
  }
};

export const stripInvalidFileNameCharacters: (name: string) => string = (
  name
) => name.replace(new RegExp(invalidCharactersRegExp, "g"), "");

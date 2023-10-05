export const prepareFormDataWithFile = (
  file: File,
  fields: Record<string | number, string> = {}
) => {
  const formData = new FormData();

  if (fields) {
    for (const key of Object.keys(fields)) {
      formData.append(key, fields[key]);
    }
  }

  formData.append("file", new Blob([file]));

  return formData;
};

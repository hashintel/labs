// Convert Map objects, possibly nested inside arrays or other maps, to plain JS
// objects.
export const convertToObject = (value: any): any => {
  if (Array.isArray(value)) {
    return value.map(convertToObject);
  } else if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries(), ([k, v]) => [k, convertToObject(v)]),
    );
  }
  return value;
};

/** `code` in backticks and **an option's label** in double stars; plain text otherwise. */
const MARK = /(`[^`]+`|\*\*[^*]+\*\*)/u;

/** One line of the stage texts with its marks dropped, for a screen reader. */
export function plainText(text: string): string {
  return text.replace(/`([^`]+)`/gu, "$1").replace(/\*\*([^*]+)\*\*/gu, "$1");
}

/** One line of the stage texts, with its code and its bold option labels set. */
export const RichText: React.FC<{ text: string }> = ({ text }) => {
  return (
    <>
      {text.split(MARK).map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
          return <code key={index}>{part.slice(1, -1)}</code>;
        }
        if (part.startsWith("**") && part.endsWith("**") && part.length > 3) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        return part;
      })}
    </>
  );
};

export const postFormData = async (
  url: string,
  formData: FormData,
  reportProgress?: (value: number) => void
) => {
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open("POST", url);

    if (reportProgress) {
      request.upload.addEventListener("progress", (evt) => {
        reportProgress(Math.round((evt.loaded / evt.total) * 100));
      });
    }

    request.upload.addEventListener("load", () => {
      resolve();
    });

    request.upload.addEventListener("error", () => {
      reject(new Error(`Error uploading file: ${request.statusText}`));
    });

    request.send(formData);
  });
};

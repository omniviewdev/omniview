// Test if a string is a valid URL
export const IsImage = (text: string | undefined) => {
  if (text === undefined) {
    return false;
  }

  return /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$|\.(gif|jpe?g|tiff?|png|webp|bmp)$/i.test(text);
};

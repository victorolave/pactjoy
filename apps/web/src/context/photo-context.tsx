import { createContext, type ReactNode, useContext } from "react";
import type { ImageProcessor } from "../ports/image-processor.ts";
import type { PhotoUploader } from "../ports/photo-uploader.ts";

export interface PhotoTools {
  readonly imageProcessor: ImageProcessor;
  readonly photoUploader: PhotoUploader;
}

const PhotoContext = createContext<PhotoTools | null>(null);

export function PhotoProvider({
  tools,
  children,
}: {
  readonly tools: PhotoTools;
  readonly children: ReactNode;
}) {
  return <PhotoContext.Provider value={tools}>{children}</PhotoContext.Provider>;
}

export function usePhotoTools(): PhotoTools {
  const tools = useContext(PhotoContext);
  if (tools === null) throw new Error("usePhotoTools must be used inside a PhotoProvider");
  return tools;
}

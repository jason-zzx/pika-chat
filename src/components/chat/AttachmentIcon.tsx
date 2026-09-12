import {
  FileCode2Icon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  ImageIcon,
} from "lucide-react";

import { classifyFile, fileExtension } from "@/lib/files/media-types";
import { cn } from "@/lib/utils";

type AttachmentIconProps = {
  mediaType: string;
  filename: string;
  className?: string;
};

const CATEGORY_ICONS = {
  image: ImageIcon,
  pdf: FileTextIcon,
  text: FileCode2Icon,
} as const;

/** Category glyph shared by composer chips and message attachment cards. */
export default function AttachmentIcon({
  mediaType,
  filename,
  className,
}: AttachmentIconProps) {
  const category = classifyFile({ mediaType, filename });
  const Icon =
    category === "office"
      ? fileExtension(filename) === "xlsx"
        ? FileSpreadsheetIcon
        : FileTextIcon
      : category
        ? CATEGORY_ICONS[category]
        : FileIcon;
  return (
    <Icon aria-hidden="true" className={cn("size-4 shrink-0", className)} />
  );
}

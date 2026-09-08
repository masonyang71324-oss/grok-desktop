import { useEffect, useState } from 'react';
import { ImageIcon, Paperclip } from 'lucide-react';
import type { Attachment } from './types';
import { request } from './lib';

export default function AttachmentThumbnail({ file }: { file: Attachment }) {
  const isImage = file.kind === 'image' || /\.(png|jpe?g|gif|webp)$/i.test(file.path);
  const [preview, setPreview] = useState<{ path: string; url: string } | null>(null);
  useEffect(() => {
    if (!isImage || !file.path) return;
    let disposed = false;
    void request<{ dataUrl?: string }>('attachment.preview', { path: file.path }).then(
      (result) => {
        if (!disposed && result.dataUrl) setPreview({ path: file.path, url: result.dataUrl });
      },
      () => {
        /* Clicking the attachment displays the existing preview error. */
      },
    );
    return () => {
      disposed = true;
    };
  }, [file.path, isImage]);
  if (!isImage) return <Paperclip size={13} />;
  return preview?.path === file.path ? (
    <img className="attachment-thumbnail" src={preview.url} alt="" />
  ) : (
    <ImageIcon size={20} />
  );
}

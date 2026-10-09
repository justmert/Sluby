import { uploadStore, uploadTabs } from '@/lib/studio-upload';
import { UploadPanel } from './UploadPanel';

/** The panel on the studio's own store, loaded with the sheet so tus stays out of the first load. */
export default function StudioUploadPanel() {
  return <UploadPanel store={uploadStore} tabs={uploadTabs} />;
}

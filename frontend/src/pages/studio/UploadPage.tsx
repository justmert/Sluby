import { BackToVideosButton } from '@/components/layout/page-actions';
import { PAGE_HEADS } from '@/components/layout/page-heads';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { UploadPanel } from '@/components/upload/UploadPanel';
import { uploadStore, uploadTabs } from '@/lib/studio-upload';

/**
 * Uploading, as its own page under Videos. The work lives in the studio's
 * upload store, so a transfer keeps going on every other page, and the top
 * bar's ring shows it there.
 */
export default function UploadPage() {
  return (
    <PageContainer>
      <PageHeader {...PAGE_HEADS.upload} primaryAction={<BackToVideosButton />} />
      <UploadPanel store={uploadStore} tabs={uploadTabs} />
    </PageContainer>
  );
}

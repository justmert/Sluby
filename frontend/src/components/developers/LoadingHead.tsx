import { PageHeader, type PageHeaderProps } from '@/components/shared/PageHeader';

/**
 * A page's header as its route skeleton draws it: the same title and
 * description in the same boxes, so they wrap the same, but the title is not
 * an h1. While the code loads the only h1 is the route's "Loading page".
 */
export function LoadingHead(props: PageHeaderProps) {
  return (
    <PageHeader
      {...props}
      heading={
        <div dir="auto" className="truncate font-heading text-title">
          {props.title}
        </div>
      }
    />
  );
}

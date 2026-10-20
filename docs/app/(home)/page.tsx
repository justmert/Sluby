import Link from 'next/link';
import { BookOpen, Code, Server } from 'lucide-react';
import type { ReactNode } from 'react';

const sections: {
  href: string;
  title: string;
  body: string;
  icon: ReactNode;
  links: [string, string][];
}[] = [
  {
    href: '/studio',
    title: 'Studio',
    body: 'Upload, watch, share and manage videos in the Sluby Studio.',
    icon: <BookOpen className="size-5" />,
    links: [
      ['/studio/upload', 'Upload a video'],
      ['/studio/share', 'Share or embed a video'],
      ['/studio/members', 'Invite and manage members'],
    ],
  },
  {
    href: '/self-hosting',
    title: 'Self-hosting',
    body: 'Install Sluby on your server, connect Sia storage and run it in production.',
    icon: <Server className="size-5" />,
    links: [
      ['/self-hosting/sia-storage', 'Connect Sia storage'],
      ['/self-hosting/production', 'Run in production'],
      ['/self-hosting/configuration', 'Configuration reference'],
    ],
  },
  {
    href: '/developers',
    title: 'Developers',
    body: 'Build on the REST API, @sluby/sdk and @sluby/player, and see how Sluby works.',
    icon: <Code className="size-5" />,
    links: [
      ['/developers/guides/upload', 'Upload videos from your app'],
      ['/developers/reference/sdk', '@sluby/sdk reference'],
      ['/developers/ai-agents', 'Use Sluby with AI agents'],
    ],
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 md:py-24">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Sluby documentation</h1>
      <p className="mt-4 max-w-2xl text-lg text-fd-muted-foreground">
        Sluby is a self-hosted video platform that stores its media on the Sia network. Pick the
        part that matches what you are doing.
      </p>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {sections.map((section) => (
          <section
            key={section.href}
            className="flex flex-col rounded-xl border bg-fd-card p-5 text-fd-card-foreground"
          >
            <Link href={section.href} className="group flex flex-col gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary">
                {section.icon}
              </span>
              <h2 className="text-lg font-semibold group-hover:text-fd-primary">{section.title}</h2>
              <p className="text-sm text-fd-muted-foreground">{section.body}</p>
            </Link>
            <ul className="mt-4 flex flex-col gap-1.5 border-t pt-4 text-sm">
              {section.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="text-fd-muted-foreground hover:text-fd-primary">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

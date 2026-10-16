// each page's title and description, and its primary action, in one place
// for the page and for its route skeleton. the skeleton draws the same text
// in the same boxes, so it wraps exactly like the page at any width, font
// size or scrollbar, and the page lands where the skeleton was

export const PAGE_HEADS = {
  overview: { title: 'Overview', description: 'Your videos, plays and what needs your attention.' },
  videos: { title: 'Videos' },
  upload: {
    title: 'Upload videos',
    description: 'Uploads keep going if you leave this page. Finished videos show up in Videos.',
  },
  quickstart: {
    title: 'Quickstart',
    description: 'Play a video on your site, then automate uploads from your server.',
  },
  keys: { title: 'API keys', description: 'For the REST API and SDK, shown once when created' },
  webhooks: {
    title: 'Webhooks',
    description: 'Requests this server sends you when a video changes',
  },
  explorer: { title: 'API explorer', description: 'Send requests to this server as you' },
  health: {
    title: 'Health',
    description: 'Whether this server and its Sia storage are working',
  },
  metrics: { title: 'Metrics', description: 'Server activity since it last started' },
  settings: {
    title: 'Settings',
    description: 'Your account, where you are signed in, and how the Studio looks.',
  },
} as const;

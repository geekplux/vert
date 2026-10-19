import type { Story } from '@ladle/react';
import { Wordmark } from './Wordmark';

export default { title: 'Components / Wordmark' };

export const Plain: Story = () => <Wordmark />;

export const UploadTagline: Story = () => <Wordmark tagline="DROP A GPX. GET A POSTER." />;
UploadTagline.storyName = 'DROP A GPX. GET A POSTER.';

export const ViewTagline: Story = () => <Wordmark tagline="TRAIL RUNS AS TERRAIN" />;
ViewTagline.storyName = 'TRAIL RUNS AS TERRAIN';

export const PosterTagline: Story = () => <Wordmark tagline="POSTER · CHATTAHOOCHEE LOOP" />;
PosterTagline.storyName = 'POSTER · CHATTAHOOCHEE LOOP';

// The page header's wordmark: the name links home (Page handles a plain click).
export const HomeLink: Story = () => (
  <Wordmark tagline="TRAIL RUNS AS TERRAIN" link={{ href: '/', label: 'Vert, home' }} />
);
HomeLink.storyName = 'Name as a home link';

// During an export: inert (aria-disabled), greyed like the disabled Back to the run, focusable.
export const HomeLinkInert: Story = () => (
  <Wordmark
    tagline="POSTER · COOSA BACKCOUNTRY TRAIL"
    link={{ href: '/', label: 'Vert, home', disabled: true }}
  />
);
HomeLinkInert.storyName = 'Name as a home link, inert (exporting)';

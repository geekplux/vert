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

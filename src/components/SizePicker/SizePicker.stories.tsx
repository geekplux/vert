import type { Story } from '@ladle/react';
import { useState, type CSSProperties } from 'react';
import { POSTER_SIZES, SizePicker, type PosterSizeId } from './SizePicker';

export default { title: 'Components / SizePicker' };

/**
 * PosterMode aside: 380px border-box with 40px left and 32px right padding and a 1px right border,
 * a 307px content column.
 */
const column: CSSProperties = {
  width: 307,
  padding: 'var(--space-10)',
  boxSizing: 'content-box',
};

function Controlled({ initial }: { initial: PosterSizeId }) {
  const [value, setValue] = useState<PosterSizeId>(initial);
  return (
    <div style={column}>
      <SizePicker sizes={POSTER_SIZES} value={value} onChange={setValue} label="Size" />
    </div>
  );
}

export const Default: Story = () => <Controlled initial="18x24" />;

export const SocialSelected: Story = () => <Controlled initial="4x5" />;
SocialSelected.storyName = 'Social selected';

import type { Story } from '@ladle/react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Slider } from './Slider';

export default { title: 'Components / Slider' };

const box: CSSProperties = { width: 288, padding: 'var(--space-6)' };

function Box({ children }: { children: ReactNode }) {
  return <div style={box}>{children}</div>;
}

const times = (v: number) => `${v.toFixed(1)}×`;
const metres = (v: number) => `${String(v)} m`;
const metresSpoken = (v: number) => `${String(v)} metres`;

export const VerticalExaggeration: Story = () => {
  const [value, setValue] = useState(1.6);
  return (
    <Box>
      <Slider
        label="Vertical exaggeration"
        min={1}
        max={3}
        step={0.1}
        value={value}
        format={times}
        onChange={setValue}
      />
    </Box>
  );
};
VerticalExaggeration.storyName = 'Vertical exaggeration';

export const HideStartAndEnd: Story = () => {
  const [value, setValue] = useState(200);
  return (
    <Box>
      <Slider
        label="Hide start and end"
        min={0}
        max={500}
        step={100}
        value={value}
        format={metres}
        valueText={metresSpoken}
        onChange={setValue}
      />
    </Box>
  );
};
HideStartAndEnd.storyName = 'Hide start and end';

export const WithHint: Story = () => {
  const [value, setValue] = useState(200);
  return (
    <Box>
      <Slider
        label="Hide start and end"
        min={0}
        max={500}
        step={100}
        value={value}
        format={metres}
        valueText={metresSpoken}
        hint="0 shows the whole route."
        onChange={setValue}
      />
    </Box>
  );
};
WithHint.storyName = 'With hint';

export const Disabled: Story = () => {
  const [value, setValue] = useState(1.6);
  return (
    <Box>
      <Slider
        label="Vertical exaggeration"
        min={1}
        max={3}
        step={0.1}
        value={value}
        format={times}
        onChange={setValue}
        disabled
      />
    </Box>
  );
};

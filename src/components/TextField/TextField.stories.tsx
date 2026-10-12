import type { Story } from '@ladle/react';
import { useState, type CSSProperties } from 'react';
import { TextField, type TextFieldProps } from './TextField';

export default { title: 'Components / TextField' };

// The poster-mode aside is 380px border-box with 40px + 32px side padding and a 1px border: a
// 307px content column.
const aside: CSSProperties = { width: 307, boxSizing: 'content-box', padding: 'var(--space-6)' };

function Controlled(props: Omit<TextFieldProps, 'onChange'>) {
  const [value, setValue] = useState(props.value);
  return (
    <div style={aside}>
      <TextField {...props} value={value} onChange={setValue} />
    </div>
  );
}

export const Title: Story = () => (
  <Controlled label="Title" value="Coosa Backcountry Loop" maxLength={40} />
);

export const Subtitle: Story = () => (
  <Controlled label="Subtitle" value="Vogel State Park · 2026-10-03" maxLength={60} />
);

export const Signature: Story = () => (
  <Controlled label="Signature" value="@geekplux" maxLength={30} />
);

export const NearLimit: Story = () => (
  <Controlled label="Title" value="Coosa Backcountry Trail Loop, Georgia" maxLength={40} />
);
NearLimit.storyName = 'Near limit';

export const AtLimit: Story = () => (
  <Controlled label="Title" value="Coosa Backcountry Trail Loop, N. Georgia" maxLength={40} />
);
AtLimit.storyName = 'At limit';

export const EmptyWithPlaceholder: Story = () => (
  <Controlled
    label="Signature"
    value=""
    maxLength={30}
    placeholder="Your name or handle"
    hint="Printed small in the poster's corner."
  />
);
EmptyWithPlaceholder.storyName = 'Empty with placeholder';

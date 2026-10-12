import { Button } from '../../components';

export interface PosterNavProps {
  /** Leaves Poster mode for the View state. */
  onBack: () => void;
}

/** Poster-mode header control (PosterMode frame). */
export function PosterNav({ onBack }: PosterNavProps) {
  return (
    <Button variant="secondary" onClick={onBack}>
      Back to the run
    </Button>
  );
}

import { Button } from '../../components';

export interface PosterNavProps {
  /** Leaves Poster mode for the View state. */
  onBack: () => void;
  /** True while a poster exports: the run stays until the export ends or is cancelled. */
  disabled?: boolean;
}

/** Poster-mode header control (PosterMode frame). */
export function PosterNav({ onBack, disabled = false }: PosterNavProps) {
  return (
    <Button variant="secondary" disabled={disabled} onClick={onBack}>
      Back to the run
    </Button>
  );
}

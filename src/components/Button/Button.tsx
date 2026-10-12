import type { ComponentPropsWithRef, ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'icon';
export type ButtonSize = 'md' | 'lg';

/** Text variants may carry an aria-label; the icon variant must, because it has no visible text. */
type TextVariant =
  | { variant: 'primary' | 'secondary' | 'quiet'; 'aria-label'?: string }
  | { variant: 'icon'; 'aria-label': string };

interface CommonProps {
  /** `md` (default): 15/600, min-height 44. `lg`: 16/600, min-height 48 (Download PNG). */
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}

type Own = 'aria-label' | 'className' | 'children';

/** Renders `<button>`. `type` defaults to "button". */
type ButtonElementProps = Omit<ComponentPropsWithRef<'button'>, Own> & { href?: never };

/**
 * Renders `<a href>` with the same look. Only for navigation (DECISIONS.md); links cannot be
 * disabled and have no `type`.
 */
type LinkElementProps = Omit<ComponentPropsWithRef<'a'>, Own | 'href'> & {
  href: string;
  disabled?: never;
  type?: never;
};

type Shared = TextVariant & CommonProps;
export type ButtonAsButtonProps = Shared & ButtonElementProps;
export type ButtonAsLinkProps = Shared & LinkElementProps;
export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

function isLink(props: ButtonProps): props is ButtonAsLinkProps {
  return typeof props.href === 'string';
}

function classNames(variant: ButtonVariant, size: ButtonSize, className?: string): string {
  return [styles.button, styles[variant], size === 'lg' ? styles.lg : undefined, className]
    .filter(Boolean)
    .join(' ');
}

export function Button(props: ButtonProps) {
  if (isLink(props)) {
    const { variant, size = 'md', className, children, ...linkProps } = props;
    return (
      <a
        {...linkProps}
        className={classNames(variant, size, className)}
        data-variant={variant}
        data-size={size}
      >
        {children}
      </a>
    );
  }

  const { variant, size = 'md', className, type = 'button', children, ...buttonProps } = props;
  return (
    <button
      {...buttonProps}
      type={type}
      className={classNames(variant, size, className)}
      data-variant={variant}
      data-size={size}
    >
      {children}
    </button>
  );
}

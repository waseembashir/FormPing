/**
 * FormPing component kit (FR-35) — the shared primitives every redesigned area is
 * built from. Import from `@/components/ui`:
 *
 *   import { Button, Card, StatusPill, PageHeader } from '@/components/ui';
 *
 * Colour comes from the design tokens (tailwind.config.ts ← globals.css vars);
 * status comes from the canonical vocabulary (@/lib/design/status).
 */
export { cx } from './cx';
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export { Card, CardHeader, CardBody, type CardProps } from './Card';
export { Badge, type BadgeTone } from './Badge';
export { StatusDot, StatusPill, StatusText } from './Status';
export { Input, Textarea, Select, Field } from './Field';
export { Tabs, type TabItem } from './Tabs';
export { Modal } from './Modal';
export { PageHeader } from './PageHeader';
export { EmptyState } from './EmptyState';
export { Skeleton } from './Skeleton';
export { RerunButton, RerunTag } from './Rerun';
export { KeptNotice } from './KeptNotice';
export { ConfirmDialog } from './ConfirmDialog';

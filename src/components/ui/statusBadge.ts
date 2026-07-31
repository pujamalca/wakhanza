import type { OutboxStatus } from '@/models';
import type { BadgeVariant } from './Badge';

export function outboxStatusVariant(status: OutboxStatus): BadgeVariant {
  if (status === 'sent') return 'success';
  if (status === 'pending' || status === 'sending') return 'warning';
  if (status.startsWith('skipped')) return 'neutral';
  return 'danger';
}

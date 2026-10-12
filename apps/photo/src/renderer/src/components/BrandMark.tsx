import markUrl from '../assets/auram-mark-inverse.png';

/**
 * The official Auram mark (light-on-dark variant derived from the supplied
 * logo). Auram Photo has no product mark of its own yet.
 */
export function BrandMark({
  height = 20,
  decorative = true,
}: {
  height?: number;
  decorative?: boolean;
}) {
  return (
    <img
      src={markUrl}
      style={{ height, width: 'auto' }}
      alt={decorative ? '' : 'Auram'}
      draggable={false}
    />
  );
}

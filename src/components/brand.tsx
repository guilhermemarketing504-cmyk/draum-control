/* Logotipo oficial DRAUM — vetorizado a partir de "Logotipo, versões e símbolo".
   Os SVGs ficam em /public/brand e são usados como máscara para herdar a cor (currentColor). */
export function Wordmark({ className = "h-5" }: { className?: string }) {
  return (
    <span role="img" aria-label="DRAUM" className={`inline-block aspect-[784/138] bg-current ${className}`}
      style={{ WebkitMask: "url(/brand/wordmark.svg) center/contain no-repeat", mask: "url(/brand/wordmark.svg) center/contain no-repeat" }} />
  );
}
export function Symbol({ className = "h-6" }: { className?: string }) {
  return (
    <span role="img" aria-label="D" className={`inline-block aspect-[214/238] bg-current ${className}`}
      style={{ WebkitMask: "url(/brand/symbol.svg) center/contain no-repeat", mask: "url(/brand/symbol.svg) center/contain no-repeat" }} />
  );
}
export function Tagline({ className = "h-[7px]" }: { className?: string }) {
  return (
    <span role="img" aria-label="The Art of Movement" className={`inline-block aspect-[622/23] bg-current ${className}`}
      style={{ WebkitMask: "url(/brand/tagline.svg) center/contain no-repeat", mask: "url(/brand/tagline.svg) center/contain no-repeat" }} />
  );
}

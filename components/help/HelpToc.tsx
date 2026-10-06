'use client';
import { useEffect, useState } from 'react';

// "On this page": the article's sections, with the one you're reading highlighted.
export default function HelpToc({ items }: { items: { id: string; text: string }[] }) {
  const [on, setOn] = useState(items[0]?.id);
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter(Boolean) as HTMLElement[];
    const pick = () => {
      let cur = els[0]?.id;
      for (const el of els) if (el.getBoundingClientRect().top < 120) cur = el.id;
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) cur = els[els.length - 1]?.id;
      setOn(cur);
    };
    pick();
    window.addEventListener('scroll', pick, { passive: true });
    return () => window.removeEventListener('scroll', pick);
  }, [items]);
  if (items.length < 2) return null;
  return (
    <nav className="hcx-toc" aria-label="On this page">
      <h2>On this page</h2>
      <ul>{items.map((i) => <li key={i.id}><a href={`#${i.id}`} className={on === i.id ? 'on' : undefined}>{i.text}</a></li>)}</ul>
    </nav>
  );
}

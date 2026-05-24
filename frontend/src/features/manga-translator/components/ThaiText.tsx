import React from 'react';

interface ThaiTextProps {
  children: string;
  className?: string;
}

export const ThaiText: React.FC<ThaiTextProps> = ({ children, className }) => {
  return (
    <span
      lang="th"
      className={`font-sans tracking-wide leading-[1.8] ${className}`}
      style={{
        fontFamily: "'Sarabun', 'Kanit', Tahoma, sans-serif",
        wordBreak: 'keep-all',
        lineBreak: 'strict',
      }}
    >
      {children}
    </span>
  );
};

export default ThaiText;

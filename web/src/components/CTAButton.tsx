import React from 'react'

type CTAButtonProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: 'primary' | 'secondary'
}

export function CTAButton({ variant = 'primary', className = '', children, ...rest }: CTAButtonProps) {
  const classes = ['cta-button', variant === 'secondary' ? 'cta-button--secondary' : 'cta-button--primary']
  if (className) classes.push(className)
  return (
    <a {...rest} className={classes.join(' ')}>
      {children}
    </a>
  )
}

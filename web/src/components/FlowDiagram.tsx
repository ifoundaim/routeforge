import React from 'react'

const steps = ['Create', 'Preview (Agent)', 'Publish', '302 Redirect', 'Hits/Evidence']

export function FlowDiagram() {
  return (
    <figure className="flow-diagram" role="group" aria-labelledby="flow-diagram-title">
      <figcaption id="flow-diagram-title" className="visually-hidden">
        Five step diagram showing the agent release workflow from create to evidence
      </figcaption>
      <ol className="flow-diagram-steps">
        {steps.map((step, index) => (
          <li key={step} className="flow-diagram-step">
            <span className="flow-diagram-index" aria-hidden="true">
              {index + 1}
            </span>
            <span className="flow-diagram-label">{step}</span>
          </li>
        ))}
      </ol>
    </figure>
  )
}

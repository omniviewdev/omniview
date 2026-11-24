import type { PropGroup } from '../scripts/props';

export function PropsReference({ groups }: { groups: PropGroup[] }) {
  if (!groups.length) return <p>No public component prop reference.</p>;

  return (
    <div className="props-reference">
      {groups.map(({ name, props }) => (
        <div className="props-group" key={name}>
          <h3>{name}</h3>
          {props.length === 0 ? <p>This component takes no props.</p> : (
            <div className="props-table-scroll" role="region" aria-label={`${name} props`} tabIndex={0}>
              <table className="props-table" aria-label={`${name} props`}>
                <thead>
                  <tr>
                    <th scope="col">Prop</th>
                    <th scope="col">Type</th>
                    <th scope="col">Required</th>
                    <th scope="col">Default</th>
                    <th scope="col">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {props.map(({ name: prop, type, required, defaultValue, description }) => (
                    <tr key={prop}>
                      <th scope="row"><code>{prop}</code></th>
                      <td><code>{type}</code></td>
                      <td>{required ? 'Yes' : 'No'}</td>
                      <td>{defaultValue === undefined ? '—' : <code>{defaultValue}</code>}</td>
                      <td>{description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const ROWS: [string, string][] = [
  ['Move', 'WASD or arrow keys'],
  ['In mazes', 'A / D steer, W / S drive forward and back'],
  ['Jump', 'Space'],
  ['Look around', 'Drag with the mouse (outside mazes)'],
  ['50/50', 'Q'],
  ['Hint', 'E'],
  ['Drop block', 'F'],
  ['Power-ups', '1 – 4'],
  ['Read question aloud', 'R'],
  ['Mute', 'M'],
  ['Pause', 'Esc or P'],
  ['Quick Select (hub)', 'Tab'],
];

export default function Controls() {
  return (
    <table className="keys">
      <tbody>{ROWS.map(([a, k]) => <tr key={a}><td>{a}</td><td>{k}</td></tr>)}</tbody>
    </table>
  );
}

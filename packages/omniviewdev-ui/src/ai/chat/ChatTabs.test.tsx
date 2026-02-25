import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatTabs from './ChatTabs';

const tabs = [
  { id: '1', label: 'Chat 1' },
  { id: '2', label: 'Chat 2' },
  { id: '3', label: 'Chat 3' },
];

describe('ChatTabs', () => {
  it('renders tab for each conversation', () => {
    render(<ChatTabs tabs={tabs} activeId="1" onSelect={vi.fn()} />);
    expect(screen.getByText('Chat 1')).toBeInTheDocument();
    expect(screen.getByText('Chat 2')).toBeInTheDocument();
    expect(screen.getByText('Chat 3')).toBeInTheDocument();
  });

  it('click tab calls onSelect', () => {
    const onSelect = vi.fn();
    render(<ChatTabs tabs={tabs} activeId="1" onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Chat 2'));
    expect(onSelect).toHaveBeenCalledWith('2');
  });

  it('close button calls onClose with tab id', () => {
    const onClose = vi.fn();
    render(<ChatTabs tabs={tabs} activeId="1" onSelect={vi.fn()} onClose={onClose} />);
    // Close buttons are icon buttons with CloseIcon
    const closeButtons = screen.getAllByTestId('CloseIcon');
    // Click the close button for the second tab
    fireEvent.click(closeButtons[1]);
    expect(onClose).toHaveBeenCalledWith('2');
  });

  it('new tab button calls onNew', () => {
    const onNew = vi.fn();
    render(<ChatTabs tabs={tabs} activeId="1" onSelect={vi.fn()} onNew={onNew} />);
    // AddIcon button
    const addIcon = screen.getByTestId('AddIcon');
    fireEvent.click(addIcon.closest('button')!);
    expect(onNew).toHaveBeenCalledOnce();
  });
});

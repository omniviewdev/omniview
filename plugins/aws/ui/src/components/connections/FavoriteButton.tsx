import React from 'react';
import { IconButton } from '@omniviewdev/base-ui';
import { LuStar } from 'react-icons/lu';

type Props = {
  isFavorite: boolean;
  onToggle: () => void;
};

const FavoriteButton: React.FC<Props> = ({ isFavorite, onToggle }) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle();
  };

  return (
    <IconButton
      size='sm'
      variant='ghost'
      color={isFavorite ? 'warning' : 'neutral'}
      aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      aria-pressed={isFavorite}
      onClick={handleClick}
      style={{ minWidth: 28, minHeight: 28 }}
    >
      <LuStar
        size={16}
        fill={isFavorite ? 'currentColor' : 'none'}
      />
    </IconButton>
  );
};

export default FavoriteButton;

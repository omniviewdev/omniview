import React from 'react';
import { IconButton } from '@omniviewdev/ui/buttons';
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
      emphasis='ghost'
      color={isFavorite ? 'warning' : 'neutral'}
      onClick={handleClick}
      sx={{ minWidth: 24, minHeight: 24 }}
    >
      <LuStar
        size={14}
        fill={isFavorite ? 'currentColor' : 'none'}
      />
    </IconButton>
  );
};

export default FavoriteButton;

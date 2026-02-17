import React from 'react';
import { IconButton } from '@mui/joy';
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
      variant='plain'
      color={isFavorite ? 'warning' : 'neutral'}
      onClick={handleClick}
      sx={{ minWidth: 28, minHeight: 28 }}
    >
      <LuStar
        size={16}
        fill={isFavorite ? 'currentColor' : 'none'}
      />
    </IconButton>
  );
};

export default FavoriteButton;

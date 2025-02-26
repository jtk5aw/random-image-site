import { MdFavorite, MdSentimentVerySatisfied, MdOutlineWavingHand } from 'react-icons/md';
import { ImShocked } from 'react-icons/im';
import { FaRegFaceGrinTongueSquint } from 'react-icons/fa6';
import { NO_REACTION } from '../../config/constants';

// Function to get the icon component for a given reaction type
export const getIconComponent = (reaction) => {
  switch (reaction) {
    case 'Love':
      return MdFavorite;
    case 'Funny':
      return MdSentimentVerySatisfied;
    case 'Tough':
      return FaRegFaceGrinTongueSquint;
    case 'Wow':
      return ImShocked;
    case NO_REACTION:
    default:
      return null;
  }
};

export default { getIconComponent };

import React, { useState } from 'react'
import '../../App.css';
import { getIconComponent } from './icons';

export const SelectorEmoji = ({ icon, selected, label, onSelect }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  
  const handleClick = () => {
    // Start animation
    setIsAnimating(true);
    
    // Call the parent's onSelect handler
    onSelect && onSelect(label);
    
    // Reset animation after it completes
    setTimeout(() => {
      setIsAnimating(false);
    }, 300); // Duration matches our animation time
  }

  // Get the icon component for this reaction
  const IconComponent = getIconComponent(label);

  return (
    <div className='flex justify-center p-1 items-center'> 
      {IconComponent && (
        <IconComponent 
          className={`${selected && isAnimating ? 'animate-pop' : ''} ${selected ? 'text-red-500' : ''}`}
          size={64} 
          onClick={handleClick}
        />
      )}
    </div>
  )
}

export default SelectorEmoji;

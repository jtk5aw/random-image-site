import React from 'react'
import '../../App.css';

export const SelectorEmoji = ({ icon, selected, label, onSelect }) => {

  const handleClick = () => {
    onSelect && onSelect(label)
  }

  // Use the created syltes in APP CSS and replace background image with just an image tag to simplify things. 
  // Then work to get a multistep transitino in place

  return (
    <div className='flex justify-center p-1 items-center'> 
      <img className={selected ? 'h-24 w-24 animate-pulse' : 'h-24 w-24 hover:animate-pulse' } src={icon} onClick={ handleClick } />
    </div>
  )
}

export default SelectorEmoji
import React from 'react'
import '../../App.css';

export const SelectorEmoji = ({ icon, selected, label, onSelect }) => {

  const handleClick = () => {
    onSelect && onSelect(label)
  }

  // Use the created syltes in APP CSS and replace background image with just an image tag to simplify things. 
  // Then work to get a multistep transitino in place

  return (
    <div className="Reaction-Wrap"> 
      <img className={selected ? "Reaction-Icon-Selected" : "Reaction-Icon" } src={icon} onClick={ handleClick } />
    </div>
  )
}

export default SelectorEmoji
export const DailyImage = ({
  url, 
  alt, 
  className = 'object-scale-down max-w-50 max-h-50 p-2', 
  onClick = null
}) => {
  const handleClick = () => {
    onClick && onClick(url)
  }

  return <img 
            src={`${url}`} 
            className={className} 
            alt={`${alt}`} 
            onClick={handleClick}/>
}

DailyImage.defaultProps = {
    url: '',
    alt: 'no image. This is the default alt-text',
  }
  
export default DailyImage
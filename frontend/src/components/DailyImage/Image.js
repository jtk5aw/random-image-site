export const DailyImage = ({url, alt}) => {
    return <img src={`${url}`} className='object-scale-down max-w-50 max-h-50 p-2' alt={`${alt}`} />
}

DailyImage.defaultProps = {
    url: '',
    alt: 'no image. This is the default alt-text',
  }
  
export default DailyImage
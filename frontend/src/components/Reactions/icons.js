const icons = {
    'Funny': 'https://jtken.com/funny-transparent.png',
    'Wow': 'https://jtken.com/wow-transparent.png',
    'Eesh':'https://jtken.com/eesh-transparent.png' ,
    'Love': 'https://jtken.com/love-transparent.png',
    'Pain': 'https://jtken.com/pain-transparent.png',
    'Tough': 'https://jtken.com/tough-transparent.png',
}
export const getIcon = (name) => {
    return icons[name] || 'n/a'
}

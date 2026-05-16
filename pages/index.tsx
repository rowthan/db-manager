export async function getServerSideProps() {
  return {
    redirect: {
      destination: '/db',
      permanent: false,
    },
  }
}

export default function Home() {
  return null
}

import { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://aviationsafetywatch.com",
      lastModified: new Date(),
    },
  ];
}
